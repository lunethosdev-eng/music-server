FROM node:20-alpine

# Metadatos
LABEL version="1.0.0"
LABEL description="Sekai Music Server"

# Directorio de trabajo
WORKDIR /app

# Copiar package.json
COPY package.json package-lock.json* ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código
COPY server.js .
COPY index.html .

# Crear directorios
RUN mkdir -p /app/music /app/covers

# Puerto por defecto
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

# Comando de inicio
CMD ["npm", "start"]
