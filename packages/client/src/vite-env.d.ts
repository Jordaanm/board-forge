/// <reference types="vite/client" />

// Vite-specific module suffixes used in this project.
declare module '*?worker' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}

declare module '*?raw' {
  const content: string;
  export default content;
}
