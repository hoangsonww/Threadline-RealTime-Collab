// Loading placeholders for list-shaped content, built from the exact same
// container classes as the real rows so nothing shifts when real data swaps
// in. Rendering the true "empty" copy ("No rooms yet", etc.) before a fetch
// has actually resolved is misleading — these exist so every list-driven
// page can distinguish "still loading" from "genuinely empty."

export function Skeleton({
  width = "100%",
  height = "0.85em",
  circle = false,
  style,
}: {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: circle ? "50%" : "6px", ...style }}
    />
  );
}

function Rows({ count, render }: { count: number; render: (key: number) => React.ReactNode }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index}>
          {render(index)}
        </div>
      ))}
    </>
  );
}

export function RoomCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="room-card" key={key}>
          <span className="room-card-icon">
            <Skeleton width={22} height={22} circle />
          </span>
          <span>
            <h4>
              <Skeleton width="55%" height="1em" />
            </h4>
            <p>
              <Skeleton width="80%" />
            </p>
          </span>
          <span className="room-meta">
            <Skeleton width={64} />
            <Skeleton width={48} />
          </span>
        </div>
      )}
    />
  );
}

export function DirectoryCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="directory-card" key={key}>
          <span className="directory-icon">
            <Skeleton width={23} height={23} circle />
          </span>
          <span className="directory-card-head">
            <Skeleton width="60%" height="1em" />
          </span>
          <p>
            <Skeleton width="85%" />
          </p>
          <span className="directory-card-footer">
            <Skeleton width={56} />
          </span>
        </div>
      )}
    />
  );
}

export function ActivityItemSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="activity-item" key={key}>
          <span className="avatar" aria-hidden="true" />
          <div>
            <p>
              <Skeleton width="70%" />
            </p>
            <Skeleton width={70} height="0.75em" />
          </div>
        </div>
      )}
    />
  );
}

export function ActivityFeedRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="activity-feed-row" key={key}>
          <span className="activity-feed-icon">
            <Skeleton width={18} height={18} circle />
          </span>
          <span>
            <Skeleton width="45%" height="1em" />
            <p>
              <Skeleton width="65%" />
            </p>
          </span>
          <Skeleton width={90} height="0.75em" />
        </div>
      )}
    />
  );
}

export function CalendarEventSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="calendar-event" key={key}>
          <span>
            <Skeleton width={48} height="1em" />
            <Skeleton width={40} height="0.8em" style={{ marginTop: 4 }} />
          </span>
          <div>
            <h3>
              <Skeleton width="50%" height="1em" />
            </h3>
            <p>
              <Skeleton width="75%" />
            </p>
          </div>
        </div>
      )}
    />
  );
}

export function MemberRowSkeleton({ count = 4, withActions = false }: { count?: number; withActions?: boolean }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className={`member-row ${withActions ? "member-row-with-actions" : ""}`} key={key}>
          <span className="avatar" aria-hidden="true" />
          <div>
            <Skeleton width="50%" height="1em" />
            <Skeleton width="70%" height="0.8em" style={{ marginTop: 4 }} />
          </div>
          <Skeleton width={54} height="1.4em" />
          {withActions && <Skeleton width="60%" />}
          <Skeleton width={withActions ? 90 : 60} height="1.6em" />
        </div>
      )}
    />
  );
}

export function SidebarRoomSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="sidebar-room" key={key}>
          <Skeleton width="75%" />
        </div>
      )}
    />
  );
}

export function KeyRowSkeleton({ count = 2 }: { count?: number }) {
  return (
    <Rows
      count={count}
      render={(key) => (
        <div className="key-row" key={key}>
          <div>
            <Skeleton width="40%" height="1em" />
            <Skeleton width="65%" height="0.8em" style={{ marginTop: 4 }} />
          </div>
          <Skeleton width={72} height="1.8em" />
        </div>
      )}
    />
  );
}
