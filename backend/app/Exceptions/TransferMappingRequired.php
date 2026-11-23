<?php

namespace App\Exceptions;

use Illuminate\Validation\ValidationException;

/**
 * STK-02: a transfer receipt has lines the receiving store must map by hand —
 * either nothing matches, or the barcode matches a different article. It stays
 * a 422 validation error (same message text as before) and also carries the
 * structured lines so a screen can offer the candidate or create-on-receive.
 */
class TransferMappingRequired extends ValidationException
{
    /** @var array<int, array<string, mixed>> */
    public array $unresolved = [];

    /**
     * @param array<int, array<string, mixed>> $lines
     */
    public static function forLines(array $lines): self
    {
        /** @var self $exception */
        $exception = static::withMessages([
            'lines' => array_values(array_map(fn (array $line) => (string) $line['message'], $lines)),
        ]);
        $exception->unresolved = array_values($lines);

        return $exception;
    }

    /** Laravel's handler calls this before its generic validation response. */
    public function render($request): \Illuminate\Http\JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'errors' => $this->errors(),
            'unresolved' => $this->unresolved,
        ], 422);
    }
}
