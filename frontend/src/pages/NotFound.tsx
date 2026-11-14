import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">This page doesn't exist</h1>
      <p className="mt-2 text-navy-mute">The link may be mistyped, or the page has moved.</p>
      <Link to="/" className="btn-primary mt-6">Go to the home page</Link>
    </div>
  );
}
