/** REST 호출. 서버는 항상 ApiResponse 형식으로 응답한다: {success, code, message, data} */

export interface ApiResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data?: T;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  let body: ApiResponse<T>;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("NETWORK", `서버 응답을 읽을 수 없음 (HTTP ${res.status})`);
  }
  if (!body.success) throw new ApiError(body.code, body.message);
  return body.data as T;
}
