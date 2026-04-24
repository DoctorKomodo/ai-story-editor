import { useParams } from 'react-router-dom';

export function EditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-semibold">Editor</h1>
      <p>Story: {id}</p>
    </main>
  );
}
