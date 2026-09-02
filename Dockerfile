FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig*.json vite*.ts playwright.config.ts ./
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4173 4174 4175 4176 8784 8785 8786 8787
CMD ["npm", "start"]
