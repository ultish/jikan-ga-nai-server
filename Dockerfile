FROM node:12-alpine AS BUILD_IMAGE

# install vim as well
RUN apk update && apk add python make g++ vim && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

#RUN npm ci --only=production
RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

# build our app
RUN npm run build



FROM node:12-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache tzdata
ENV TZ=Australia/Melbourne

# copy from build image
COPY --from=BUILD_IMAGE /usr/src/app/dist ./dist
COPY --from=BUILD_IMAGE /usr/src/app/node_modules ./node_modules
COPY --from=BUILD_IMAGE /usr/src/app/.env ./
COPY --from=BUILD_IMAGE /usr/src/app/public ./public

EXPOSE 9998

CMD [ "node", "dist/index.js" ]