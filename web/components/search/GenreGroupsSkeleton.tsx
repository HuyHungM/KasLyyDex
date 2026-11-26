export default function GenreGroupsSkeleton() {
  return (
    <div role="status" aria-label="Đang tải thể loại" aria-busy="true">
      <section className="surface genre-group skel">
        <div className="skel-line w30" />
        <div className="tag-options">
          {Array.from({ length: 8 }, (_, pill) => <div className="skel-pill" key={pill} />)}
        </div>
      </section>
    </div>
  );
}
