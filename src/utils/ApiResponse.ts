import type { ApiResponseParams } from "../types/ApiResponseTypes";

export class ApiResponse<T> {
    statusCode: number;
    data: T;
    message: string;
    success: boolean;

    constructor({ statusCode, data, message = "Success" }: ApiResponseParams<T>) {
        this.statusCode = statusCode;
        this.data = data;
        this.message = message;
        this.success = statusCode < 400;
    }

    toJSON() {
        return {
            success: this.success,
            message: this.message,
            data: this.data,
            status: this.statusCode
        };
    }
}