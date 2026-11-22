export default function GenreGroupsSkeleton() {
  return (
    <div role="status" aria-label="Đang tải thể loại">
      {[0, 1, 2, 3].map((index) => (
        <section className="surface genre-group skel" key={index} aria-hidden="true">
          <div className="skel-line w30" />
          <div className="tag-options">
            <div className="skel-pill" />
            <div className="skel-pill" />
          </div>
        </section>
      ))}
    </div>
  );
}
