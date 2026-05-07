FROM node:20-alpine

# Instalar dependencias del sistema para spawn/python (opcional)
RUN apk add --no-cache python3

WORKDIR /app

# Copiar dependencias
COPY package.json ./
RUN npm install --production

# Copiar código
COPY . .

# Puerto de la app
EXPOSE 47829

# Directorio de datos persistentes (montar como volumen en producción)
ENV QUANT_DATA_DIR=/data
ENV QUANT_WEB_PORT=47829

# Crear directorio de datos por defecto
RUN mkdir -p /data

# Arranque headless (sin Electron)
CMD ["node", "main.js"]
