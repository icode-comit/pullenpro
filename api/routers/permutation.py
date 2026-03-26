from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.permutation_engine import generate

router = APIRouter(prefix="/permutation", tags=["Permutation"])

class PermRequest(BaseModel):
    first_name: str
    last_name:  str
    domain:     str

@router.post("/generate")
async def generate_permutations(req: PermRequest):
    if not req.first_name or not req.last_name or not req.domain:
        raise HTTPException(422, "first_name, last_name, and domain are required.")
    patterns = generate(req.first_name, req.last_name, req.domain)
    return {"domain": req.domain, "patterns": patterns}
