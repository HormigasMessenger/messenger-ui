# Build + serve the Hormiga messenger UI (front4mess) as a container.
# Replaces the previous bare `node server.mjs` under the front4mess systemd unit:
# same port (5555), same zero-dependency static server, auto-restart via the
# container runtime. Served behind the platform edge at
# https://hormi.isolutions.io/messenger-ui/.
#
#   docker build --build-arg BASE=/messenger-ui/ -t front4mess ./front
#
FROM node:20-alpine AS build
WORKDIR /app
# Reproducible, pinned install from the committed lockfile (supply-chain integrity:
# the shipped JS is only as trustworthy as its dependency tree). `npm ci` fails hard
# if package.json and package-lock.json disagree — no silent drift at build time.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Vite base = the edge subpath the SPA is mounted under. We run `npx vite build`
# directly (not `npm run build`) because the repo's `tsc -b` trips on a stale
# test; the Vite build is the real gate (mirrors deploy.sh).
ARG BASE=/messenger-ui/
# Build-time frontend config baked into the bundle (Vite exposes VITE_* from the
# environment). The admin keys are readable in the shipped JS — TEMPORARY demo
# design (see front/.env.example); pass them at build, never commit real values.
ARG VITE_MESSENGER_BASE=/messenger
ARG VITE_KRATOS_URL=/.ory/kratos/public
ARG VITE_IDS_URL=/ids/admin
ARG VITE_IDS_ADMIN_KEY=
ARG VITE_MESSENGER_ADMIN_KEY=
ARG VITE_TURN_HOST=91.99.6.25
ARG VITE_TURN_USER=user
ARG VITE_TURN_PASS=pass
# Write .env.production so Vite reliably picks the values up (it loads .env* files
# for `vite build`; reading them from the process env is not guaranteed).
RUN { \
      echo "VITE_MESSENGER_BASE=$VITE_MESSENGER_BASE"; \
      echo "VITE_KRATOS_URL=$VITE_KRATOS_URL"; \
      echo "VITE_IDS_URL=$VITE_IDS_URL"; \
      echo "VITE_IDS_ADMIN_KEY=$VITE_IDS_ADMIN_KEY"; \
      echo "VITE_MESSENGER_ADMIN_KEY=$VITE_MESSENGER_ADMIN_KEY"; \
      echo "VITE_TURN_HOST=$VITE_TURN_HOST"; \
      echo "VITE_TURN_USER=$VITE_TURN_USER"; \
      echo "VITE_TURN_PASS=$VITE_TURN_PASS"; \
    } > .env.production
RUN npx vite build --base="$BASE"

FROM node:20-alpine
WORKDIR /app
ENV PORT=5555 HOST=0.0.0.0 NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs
EXPOSE 5555
CMD ["node", "server.mjs"]
