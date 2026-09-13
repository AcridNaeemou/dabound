# DaBound — zero-dependency Node backend + static client in one image.
FROM node:22-alpine

WORKDIR /app
# the backend has no npm dependencies; only the app itself is copied
COPY package.json Procfile README.md ./
COPY server.js ./
COPY public ./public
COPY tools ./tools
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Live state (routes, jeepneys, assignments) is written to data/state.json.
# Mount a volume there and it survives restarts and redeploys:
#   docker run -p 8080:8080 -v dabound-data:/app/data -e ADMIN_KEY=choose-something dabound
# (or point DATA_DIR at any other mounted path)
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
