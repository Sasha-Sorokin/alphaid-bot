FROM node:alpine

ENV NODE_ENV production

RUN apk add --update git
RUN apk add --update python
RUN apk add --update build-base
RUN rm -rf /tmp/* /var/cache/apk/*

WORKDIR /opt/app

COPY package.json /opt/app/
COPY package-lock.json /opt/app

RUN npm i -d

RUN npm i -d full-icu
ENV NODE_ICU_DATA node_modules/full-icu

COPY . /opt/app

CMD node --trace-warnings --use_strict init.js
