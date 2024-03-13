/* eslint-disable @typescript-eslint/no-explicit-any */
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ApolloClient, ApolloProvider, InMemoryCache } from "@apollo/client";
import { createServer } from "miragejs";
import { createGraphQLHandler } from "@miragejs/graphql";
import { faker } from "@faker-js/faker";

const graphQLSchema = `
input TodoInput {
  title: String!
}

input UserInput {
  name: String!
}

type Todo {
  id: ID!
  title: String!
  completed: Boolean!
  description: String!
  updatedOn: String!
  createdBy: User!
}

type User {
  id: ID!
  name: String!
  email: String!
  reportTo: User
}

type Query {
  todos: [Todo!]
  todo(id: ID!): Todo!
  users: [User!]
}

type Mutation {
  updateTodo(id: ID!, input: TodoInput!): Todo!
  updateUser(id: ID!, input: UserInput!): User!
}
`;

createServer({
  routes() {
    const handler = createGraphQLHandler(graphQLSchema, this.schema, {
      context: null,
      root: null,
      resolvers: {
        Todo: {
          createdBy: (obj: any) => {
            return this.schema
              .all("User")
              .models.find((x) => x.id === obj.createdByUserId);
          },
        },
        User: {
          reportTo: (obj: any) => {
            return (
              obj.reportToUserId &&
              this.schema
                .all("User")
                .models.find((x) => x.id === obj.reportToUserId)
            );
          },
        },
      },
    });
    this.post("/graphql", async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return handler(...args);
    });
  },
  seeds(server) {
    const maybeManagers: any[] = [];
    for (let i = 0; i < 10; i++) {
      maybeManagers.push(
        server.create("User", {
          email: faker.internet.email(),
          name: faker.person.fullName(),
          reportToUserId: maybeManagers.length
            ? faker.helpers.arrayElement(maybeManagers)
            : undefined,
        } as any).id
      );
    }

    const users = server.schema.all("User").models;

    for (let i = 0; i < 10; i++) {
      server.create("Todo", {
        title: faker.lorem.sentence(),
        description: faker.lorem.paragraph(),
        completed: faker.helpers.arrayElement([true, false]),
        updatedOn: faker.date.anytime().toISOString(),
        createdByUserId: faker.helpers.arrayElement(users).id,
      } as any);
    }
    setInterval(() => {
      server.schema.all("Todo").models.forEach((x) => {
        (x.attrs as any).updatedOn = faker.date.anytime().toISOString();
        x.save();
      });
    }, 1000);
  },
});

const client = new ApolloClient({
  cache: new InMemoryCache(),
  uri: "/graphql",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ApolloProvider client={client}>
    <App />
  </ApolloProvider>
);
