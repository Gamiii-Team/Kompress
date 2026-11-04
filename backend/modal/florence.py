import base64
import io
import os

import modal
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

# Only lightweight imports at the top level
MODEL_ID = "microsoft/Florence-2-base"

app = modal.App("florence-2-vision")

# Cache model weights in a Modal Volume for fast restarts
volume = modal.Volume.from_name("florence-weights", create_if_missing=True)

# Build the image using requirements.txt
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_requirements("./backend/modal/requirements.txt")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})  # Enable faster downloads with progress
)


@app.cls(
    image=image,
    gpu="T4",  # Cheapest GPU, perfect for MVP free tier
    volumes={"/root/.cache/huggingface": volume},
    timeout=120,  # Allow for cold starts + inference
    scaledown_window=300,  # FIX 4: Correct parameter name (was scaledown_window)
    secrets=[modal.Secret.from_name("florence-secret")],
)
class FlorenceModel:
    @modal.enter()
    def load_model(self):
        # LAZY IMPORT: These only run inside Modal's cloud GPU environment
        from transformers import AutoModelForCausalLM, AutoProcessor

        print(f"📥 Loading model: {MODEL_ID}")

        # FIX 1: Initialize BOTH the processor and the model
        self.processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
        self.model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, trust_remote_code=True, torch_dtype="auto", device_map="auto"
        )

        print("✅ Model loaded and ready!")

    @modal.method()
    def process(self, image_base64: str, task_prompt: str) -> dict:
        # LAZY IMPORT: Only runs in the cloud
        from PIL import Image

        try:
            # Decode base64 image
            image_bytes = base64.b64decode(image_base64)
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

            # Run inference
            inputs = self.processor(
                text=task_prompt, images=image, return_tensors="pt"
            ).to(self.model.device)

            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                do_sample=False,
                num_beams=3,
            )
            generated_text = self.processor.batch_decode(
                generated_ids, skip_special_tokens=False
            )[0]
            parsed_answer = self.processor.post_process_generation(
                generated_text,
                task=task_prompt,
                image_size=(image.width, image.height),
            )

            return {"success": True, "result": parsed_answer}
        except Exception as e:
            return {"success": False, "error": str(e)}


# --- Web endpoint using FastAPI ---
web_app = FastAPI()


class ProcessRequest(BaseModel):
    image_base64: str
    task_prompt: str


# FIX 3: Define MODAL_SECRET from the environment variables
MODAL_SECRET = os.getenv("MODAL_API_SECRET", "")


@web_app.post("/process")
async def process_endpoint(item: ProcessRequest, x_api_secret: str = Header(None)):
    # FIX 2: Header and HTTPException are now properly imported above
    if not MODAL_SECRET or x_api_secret != MODAL_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")

    model = FlorenceModel()
    # FIX 5: Use .local() instead of .remote() since the web endpoint
    # and the class are running in the same Modal container. It's much faster.
    return model.process.local(item.image_base64, item.task_prompt)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("florence-secret")],
)
@modal.asgi_app()
def web():
    return web_app
