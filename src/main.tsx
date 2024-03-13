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

type Todo {
  id: ID!
  title: String!
  completed: Boolean!
  description: String!
  updatedOn: String!
}

type User {
  id: ID!
  email: String!
}

type Query {
  todos: [Todo!]
  todo(id: ID!): Todo!
  users: [User!]
}

type Mutation {
  updateTodo(id: ID!, input: TodoInput!): Todo!
}
`;

createServer({
  routes() {
    const handler = createGraphQLHandler(graphQLSchema, this.schema);
    this.post("/graphql", async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return handler(...args);
    });
  },
  seeds(server) {
    for (let i = 0; i < 10; i++) {
      server.create("Todo", {
        title: faker.lorem.sentence(),
        description: faker.lorem.paragraph(),
        completed: faker.helpers.arrayElement([true, false]),
        updatedOn: faker.date.anytime().toISOString(),
      } as any);

      server.create("User", {
        email: faker.internet.email(),
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
