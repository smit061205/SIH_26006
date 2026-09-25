# Build context is the project root (see docker-compose.yml), because this
# image needs src/ and data/ which live outside backend/.
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

# One thread per numeric library: build machines and small instances report
# more cores than they're allowed to use, and extra threads only contend.
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 LOKY_MAX_CPU_COUNT=1
# The freight models' results ship in data/forecast-cache; this only fills in
# anything missing, so the build normally takes a second here.
RUN python -m scripts.precompute_forecasts
# Some hosts run the container as an unprivileged user (uid 1000): let it own
# the app so the forecast cache stays writable (root is unaffected).
RUN useradd -m -u 1000 app && chown -R app /app

# Browsers calling the API must come from one of these origins (comma-separated).
ENV ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
# Production unless told otherwise: email links never come back in responses.
ENV APP_ENV=production

EXPOSE 8000
# Behind a proxy (Render, a load balancer), take the client's address from
# X-Forwarded-For so sign-in limits and session records see the real user.
# Hosts such as Render set PORT; locally it's 8000.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
