import { server } from './app';

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
