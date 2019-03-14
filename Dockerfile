FROM openjdk:7-jre-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN apt-get update
RUN apt-get -y install curl gnupg
RUN curl -sL https://deb.nodesource.com/setup_11.x  | bash -
RUN apt-get -y install nodejs
RUN npm install
COPY . .
EXPOSE 8080
CMD [ "npm", "start" ]