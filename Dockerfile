FROM node:12.14-alpine

WORKDIR /usr/src/app

COPY . ./

RUN npm install

# Create non root user
RUN addgroup -S oipusergroup && adduser -S oipuser -G oipusergroup
USER oipuser

EXPOSE 3000

CMD ["npm", "run" ,"start"]