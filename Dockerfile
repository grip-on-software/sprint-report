FROM node:14-alpine
EXPOSE 8080

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ARG NODE_ENV
ENV NODE_ENV $NODE_ENV
ARG NPM_REGISTRY
RUN npm config set @gros:registry $NPM_REGISTRY
COPY package*.json /usr/src/app/
RUN apk add --no-cache --virtual .gyp python make g++ && \
	npm install && npm cache clean --force && \
	apk del .gyp

CMD ["npm", "start"]
