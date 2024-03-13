import { Suspense, memo, useState } from "react";
import "./App.css";
import {
  TypedDocumentNode,
  gql,
  makeVar,
  useMutation,
  useReactiveVar,
} from "@apollo/client";
import { typed, useGQL } from "./useGQL";

type Todo = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  updatedOn: number;
};

type User = {
  id: string;
  email: string;
};

const TodoListQuery = gql`
  query GetTodoList {
    todos {
      id
      title
      updatedOn
    }
  }
` as TypedDocumentNode<{ todos: Pick<Todo, "id" | "title">[] }>;

const UpdateTodoMutation = gql`
  mutation UpdateTodoMutation($id: ID!, $input: TodoInput!) {
    updateTodo(id: $id, input: $input) {
      # To ensure data synchronization between entities, it is essential to select the "id" field when using Apollo Client.
      id
      title
      updatedOn
    }
  }
`;

const TodoByIdQuery = gql`
  query TodoByIdQuery($id: ID!) {
    todo(id: $id) {
      id
      title
      description
      completed
      updatedOn
    }
  }
` as TypedDocumentNode<
  // result type
  { todo: Todo },
  // variables type
  { id: string }
>;

const UserListQuery = gql`
  query UserListQuery {
    users {
      id
      email
    }
  }
` as TypedDocumentNode<{ users: User[] }>;

const UserList = memo(() => {
  const { userList } = useGQL({ userList: typed(UserListQuery) });
  return (
    <>
      <h2>User List</h2>
      <pre>{JSON.stringify(userList, null, 2)}</pre>
    </>
  );
});

const selectedTodoVar = makeVar<string | undefined>(undefined);

const TodoDetails = memo(() => {
  const selectedTodoId = useReactiveVar(selectedTodoVar);
  const [updateTodo, { loading }] = useMutation(UpdateTodoMutation);

  const operations = useGQL({
    getTodoById: typed(TodoByIdQuery, {
      variables: { id: selectedTodoId ?? "" },
    }),
  });

  if (!selectedTodoId) {
    return <div>No selected todo</div>;
  }

  // condition query
  const todo = operations.getTodoById.todo;

  const handleUpdate = async (
    type: "pessimistic" | "optimistic" | "restore"
  ) => {
    const title = prompt("Enter todo title", todo.title);
    if (!title) return;
    if (type === "optimistic" || type === "restore") {
      const restore = operations.write(todo, { title: title + "(optimistic)" });
      if (type === "restore") {
        alert("The todo title will be restored in 5 seconds");
        setTimeout(restore, 5000);
      }
    }
    if (type === "pessimistic" || type === "optimistic") {
      await updateTodo({ variables: { id: selectedTodoId, input: { title } } });
      alert("DONE. The todo in the list updated as well");
    }
  };

  return (
    <>
      <h2>Todo Details</h2>
      {/* fetching todo if needed  */}
      <pre>{JSON.stringify(todo, null, 2)}</pre>
      <button onClick={() => handleUpdate("pessimistic")}>
        {loading ? "Updating..." : "Change title"}
      </button>
      <button onClick={() => handleUpdate("optimistic")}>
        {loading ? "Updating..." : "Change title (Optimistic)"}
      </button>
      <button onClick={() => handleUpdate("restore")}>
        {loading ? "Updating..." : "Change title (Optimistic and Restore)"}
      </button>
    </>
  );
});

const TodoList = memo(() => {
  const { todoList, refetch, write, evict } = useGQL({
    todoList: typed(TodoListQuery),
  });
  const handleRemoveX = () => {
    const id = prompt("Enter todo id");
    if (!id) return;
    const todo = todoList.todos.find((x) => x.id === id);
    if (todo) {
      evict(todo);
    }
    // clear selected
    if (id === selectedTodoVar()) {
      selectedTodoVar(undefined);
    }
  };
  const handleRemoveFirst = () => {
    write("todoList", (prev) => {
      // clear selection
      if (prev.todos[0]?.id === selectedTodoVar()) {
        selectedTodoVar(undefined);
      }
      return {
        ...prev,
        todos: prev.todos.slice(1),
      };
    });
  };

  return (
    <>
      <h2>Todo List</h2>
      <button onClick={() => refetch("todoList")}>Refetch</button>
      <button onClick={() => refetch("todoList", true)}>Hard Refetch</button>
      <button onClick={handleRemoveFirst}>Remove First Todo</button>
      <button onClick={handleRemoveX}>Remove Todo X</button>
      <div>
        {todoList.todos.map((todo) => {
          return (
            <div key={todo.id} onClick={() => selectedTodoVar(todo.id)}>
              <pre>{JSON.stringify(todo, null, 2)}</pre>
            </div>
          );
        })}
      </div>
    </>
  );
});

function App() {
  const { preload } = useGQL({ userList: typed(UserListQuery) });
  const [showUserList, setShowUserList] = useState(false);
  const handlePreload = () => preload("userList");
  const handleToggle = () => setShowUserList(!showUserList);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "row" }}>
        <div style={{ flex: 3 }}>
          <Suspense key="TodoList" fallback={<div>Loading Todo List</div>}>
            <TodoList />
          </Suspense>
        </div>
        <div style={{ flex: 2 }}>
          <button onClick={handlePreload}>Preload User List</button>
          <button onClick={handleToggle}>Toggle User List</button>
          {showUserList && (
            <Suspense key="UserList" fallback={<div>Loading User List</div>}>
              <UserList />
            </Suspense>
          )}
          <Suspense
            key="TodoDetails"
            fallback={<div>Loading Todo Details</div>}
          >
            <TodoDetails />
          </Suspense>
        </div>
      </div>
    </>
  );
}

export default App;
