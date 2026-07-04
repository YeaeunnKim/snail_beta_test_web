/**
 * 화면 골격 placeholder.
 *
 * 프론트/디자인팀이 실제 UI로 채울 영역을 표시한다. 연결할 서비스 함수와
 * 참고할 백엔드 문서를 함께 안내해, 작업자가 바로 이어받을 수 있게 한다.
 */
export function PageStub({
  title,
  description,
  apis,
}: {
  title: string;
  description?: string;
  apis?: string[];
}) {
  return (
    <section className="rounded-lg border border-dashed border-neutral-300 bg-white p-6">
      <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-secondary">
        구현 예정 (프론트/디자인팀)
      </p>
      <h2 className="text-heading-md font-bold text-primary">{title}</h2>
      {description && <p className="mt-2 text-body-sm text-primary">{description}</p>}
      {apis && apis.length > 0 && (
        <div className="mt-4">
          <p className="text-caption text-primary-50">연결할 서비스 (src/services)</p>
          <ul className="mt-1 list-inside list-disc text-body-sm text-primary">
            {apis.map((api) => (
              <li key={api}>
                <code className="text-caption">{api}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
