declare const __APP_VERSION__: string | undefined;

export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";

/** GitHub 저장소 (owner/name). 정해지면 채운다. 비어 있으면 업데이트 확인을 안 한다 */
export const GITHUB_REPO = "";
