<?php

namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * Structured business-rule failure shared by POS, purchases, returns and stock.
 * Clients render `message` and offer `fix`; `code`/`rule`/`line`/`field` stay stable
 * for machine handling and tests.
 */
class BusinessRuleException extends Exception
{
    public const STATUS_UNPROCESSABLE = 422;

    public readonly string $errorCode;
    public readonly ?string $rule;
    public readonly ?int $lineNumber;
    public readonly ?string $field;
    public readonly ?string $fix;
    public readonly int $status;
    /** @var array<string,mixed> machine-readable facts the screen needs to act */
    public readonly array $context;

    public function __construct(
        string $errorCode,
        string $message,
        ?string $rule = null,
        ?int $line = null,
        ?string $field = null,
        ?string $fix = null,
        int $status = self::STATUS_UNPROCESSABLE,
        array $context = [],
    ) {
        parent::__construct($message);

        $this->errorCode = $errorCode;
        $this->rule = $rule;
        $this->lineNumber = $line;
        $this->field = $field;
        $this->fix = $fix;
        $this->status = $status;
        $this->context = $context;
    }

    public function toArray(): array
    {
        return array_merge([
            'success' => false,
            // Legacy clients (and older POS builds) read `error`.
            'error' => $this->getMessage(),
            'code' => $this->errorCode,
            'rule' => $this->rule,
            'line' => $this->lineNumber,
            'field' => $this->field,
            'message' => $this->getMessage(),
            'fix' => $this->fix,
        ], $this->context);
    }

    public function render(): JsonResponse
    {
        return response()->json($this->toArray(), $this->status);
    }
}
