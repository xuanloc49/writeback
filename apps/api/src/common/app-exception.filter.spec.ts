import { Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { appError, ERROR_MESSAGES_VI } from './app-error';
import { AppExceptionFilter } from './app-exception.filter';
import { REQUEST_ID_HEADER } from './request-context';

function fakeHost(requestId = 'req-123') {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    getHeader: jest.fn().mockReturnValue(undefined),
  };
  res.status.mockReturnValue(res);
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ requestId }) }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AppExceptionFilter (design §5.2 envelope)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('renders AppError QUOTA_EXCEEDED as 429 with code/message/request_id', () => {
    const { host, res } = fakeHost();
    new AppExceptionFilter().catch(appError('QUOTA_EXCEEDED'), host);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'QUOTA_EXCEEDED', message: ERROR_MESSAGES_VI.QUOTA_EXCEEDED, request_id: 'req-123' },
    });
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'req-123');
  });

  it('renders unknown errors as 500 INTERNAL without leaking the message', () => {
    const { host, res } = fakeHost();
    new AppExceptionFilter().catch(new Error('secret database dsn leaked'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0]?.[0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe(ERROR_MESSAGES_VI.INTERNAL);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps Nest NotFoundException to 404 NOT_FOUND', () => {
    const { host, res } = fakeHost();
    new AppExceptionFilter().catch(new NotFoundException('nope'), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: ERROR_MESSAGES_VI.NOT_FOUND, request_id: 'req-123' },
    });
  });
});
