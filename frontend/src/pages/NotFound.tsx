import { PageHeader } from "../components/ui/layout";
import { Link } from "../lib/router";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" description="There's no page at this address." />
      <Link to="/plan" className="text-[15px] text-accent underline underline-offset-4">
        Go to the charter plan
      </Link>
    </>
  );
}
