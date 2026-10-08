/** 작업을 한 줄로 세워 하나씩 실행한다. 생성이 겹치면 비용 계산(잔액 전후 차이)과 세션 상한이 틀어지기 때문 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
