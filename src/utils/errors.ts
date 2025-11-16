import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

interface ResponseBody {
    errorCode: string;
    errorMessage: string;
    messageVars?: string[];
    numericErrorCode: number;
    originatingService: string;
    intent: string;
    validationFailures?: Record<string, object>;
}

export type WorkflowResult = {
    success: true;
    filename: string;
    version: string;
    reason?: string;
} | {
    success: false;
    reason: string;
};


export class ApiError {
    statusCode: number;
    public response: ResponseBody;

    constructor(code: string, message: string, numeric: number, statusCode: number, ...messageVariables: string[]) {
        this.statusCode = statusCode;
        this.response = {
            errorCode: code,
            errorMessage: message,
            messageVars: messageVariables.length > 0 ? messageVariables : undefined,
            numericErrorCode: numeric,
            originatingService: 'tailflare',
            intent: 'unknown',
        };
    }

    withMessage(message: string): this {
        this.response.errorMessage = message;
        return this;
    }

    originatingService(service: string): this {
        this.response.originatingService = service;
        return this;
    }

    with(...messageVariables: string[]): this {
        this.response.messageVars = this.response.messageVars ? [...this.response.messageVars, ...messageVariables] : messageVariables;
        return this;
    }

    apply(c: Context): ResponseBody {
        this.response.errorMessage = this.getMessage();
        c.res.headers.set('Content-Type', 'application/json');
        c.res.headers.set('X-Epic-Error-Code', `${this.response.numericErrorCode}`);
        c.res.headers.set('X-Epic-Error-Name', this.response.errorCode);
        c.status(this.statusCode as unknown as ContentfulStatusCode);
        return this.response;
    }

    getMessage(): string {
        return (
            this.response.messageVars?.reduce((message, msgVar, index) => message.replace(`{${index}}`, msgVar), this.response.errorMessage) ||
            this.response.errorMessage
        );
    }

    shortenedError(): string {
        return `${this.response.errorCode} - ${this.response.errorMessage}`;
    }

    toResponse(): Response {
        return new Response(JSON.stringify(this.response), {
            status: this.statusCode,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    toWorkflowResult(): WorkflowResult {
        return {
            success: false,
            reason: this.getMessage(),
        } satisfies WorkflowResult;
    }

    throwHttpException(): never {
        const errorResponse = new Response(JSON.stringify(this.response), {
            status: this.statusCode,
            headers: {
                'Content-Type': 'application/json',
                'X-Epic-Error-Code': `${this.response.numericErrorCode}`,
                'X-Epic-Error-Name': this.response.errorCode,
            },
        });
        throw new HTTPException(this.statusCode as unknown as ContentfulStatusCode, { res: errorResponse });
    }

    devMessage(message: string, devMode: string | undefined) {
        if (devMode !== 'true') { return this; }
        this.response.errorMessage += `(Dev: -${message}-)`;
        return this;
    }
}

export const errors = {
    badRequest: new ApiError('errors.tailflare.badRequest', 'Bad request', 1001, 400),
    unauthorized: new ApiError('errors.tailflare.unauthorized', 'Unauthorized', 1002, 401),
    notFound: new ApiError('errors.tailflare.notFound', 'Not found', 1004, 404),
    internalServerError: new ApiError('errors.tailflare.internalServerError', 'Internal server error', 1008, 500),
    badGateway: new ApiError('errors.tailflare.badGateway', 'Bad gateway', 1010, 502),
    serviceUnavailable: new ApiError('errors.tailflare.serviceUnavailable', 'Service unavailable', 1011, 503),

    workflow: {
        alreadyExistsInDatabase: new ApiError('errors.workflow.alreadyExistsInDatabase', 'Already exists in database', 2001, 400),
        alreadyExistsInGitHub: new ApiError('errors.workflow.alreadyExistsInGitHub', 'Already exists in GitHub', 2002, 400),
    },

    // Utility function for custom errors
    customError(code: string, message: string, numericErrorCode: number, status: number) {
        return new ApiError(code, message, numericErrorCode, status);
    },
};

