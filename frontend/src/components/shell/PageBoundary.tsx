import { Component, type ReactNode } from "react";
import { ErrorState } from "../ui/feedback";

/** Keeps a fault in one page from taking down the header and navigation. */
export class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState message="This page hit an unexpected problem." onRetry={() => window.location.reload()} />
      );
    }
    return this.props.children;
  }
}
