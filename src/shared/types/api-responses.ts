export interface MessageResponse {
  message: string;
}

export interface SendResponse {
  sent: boolean;
  method?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
