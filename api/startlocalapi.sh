#!/bin/bash
# Run from the api/ directory: cd api && ./startlocalapi.sh
uv run uvicorn main:app --reload
