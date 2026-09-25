# Build context is the project root (see docker-compose.yml), because this
# image needs src/ and data/ which live outside backend/. The Hugging Face
# Space uses this same file as its root Dockerfile (scripts/build_hf_space.sh).
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY backend/ backend/
COPY data/ data/
# The Postgres loader and freight-series generator run in this image too.
COPY scripts/ scripts/
COPY db/ db/

# Work out every freight-model backtest and forecast now, while the build
# machine has CPU to spare (a free instance has a tenth of one): without this
# a fresh server spends minutes on its first Charter plan request.
RUN python -m scripts.precompute_forecasts
# Hugging Face Spaces run the container as user 1000: let it own the app so
# the forecast cache stays writable (hosts that run as root are unaffected).
RUN useradd -m -u 1000 app && chown -R app /app
# One thread per numeric library on the small running instance; more only contend.
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1

# Browsers calling the API must come from one of these origins (comma-separated).
ENV ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
# Production unless told otherwise: email links never come back in responses.
ENV APP_ENV=production

EXPOSE 8000
# Behind a proxy (Render, a load balancer), take the client's address from
# X-Forwarded-For so sign-in limits and session records see the real user.
# Hosts such as Render set PORT; locally it's 8000.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
