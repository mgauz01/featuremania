from fastapi import FastAPI

from src.auth.github import router as auth_router

app = FastAPI()
app.include_router(auth_router, prefix="/auth")


@app.get("/health")
def health():
    return {"status": "ok"}
