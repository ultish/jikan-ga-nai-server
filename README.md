Just testing graphql.

Playground: http://localhost:8000/graphql

# External Setup

## Postgres

Used Docker to setup Postgres. Pull the postgres container and then use this command to set up basic instance:

```
docker run  --name postgres -e POSTGRES_PASSWORD=<password for superuser> -d -p 5432:5432 -v <folder to store db data>  <postgres super username>
```

Then logged into the Docker container and created a database:

```
create database <db name>;
```

## Server properties

Created .env file under the server directory that contains:

- SECRET=a random string to seed web auth tokens
- DATABASE=your postgres database name
- DATABASE_USER=postgres super user eg: postgres
- DATABASE_PASSWORD=password for super user

# Start Server

Go into the server folder and execute:

```
npm start
```

That will start the ExpressJs server and host GraphQL at http://localhost:8000/graphql

# Start Client

Go into the client/jikan-ga-nai folder and execute:

```
ember serve
```

That will host it at http://localhost:4200
