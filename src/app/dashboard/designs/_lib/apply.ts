/**
 * 일괄 작업 공용 루프. owner 쪽엔 배치 API가 없어 모든 일괄 작업은 요청을 N번 돈다.
 * 동시 실행을 제한하고(모바일 웹 + 백엔드 부하), 진행률을 보고하며,
 * 중간 실패해도 롤백하지 않고 성공/실패로 갈라 돌려준다(PATCH는 트랜잭션이 아니다).
 * 백엔드에 일괄 엔드포인트가 생기면 이 함수 하나만 갈아끼운다.
 */
export interface ApplyResult<T> {
  ok: T[];
  failed: { target: T; error: unknown }[];
}

export async function applyToMany<T>(
  targets: T[],
  fn: (t: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<ApplyResult<T>> {
  const total = targets.length;
  const result: ApplyResult<T> = { ok: [], failed: [] };
  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < total) {
      const i = next++;
      const t = targets[i];
      try {
        await fn(t);
        result.ok.push(t);
      } catch (error) {
        result.failed.push({ target: t, error });
      }
      done++;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return result;
}
