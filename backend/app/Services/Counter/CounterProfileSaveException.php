<?php

namespace App\Services\Counter;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * A counter profile save that will not happen, carrying the answer the panel
 * already expects: 422 with field paths for a document naming a control the
 * till does not understand, 409 when the owner was editing a version the
 * counter has since left behind.
 */
class CounterProfileSaveException extends Exception
{
    /** @param array<string,list<string>> $errors */
    public function __construct(
        public readonly array $errors = [],
        public readonly int $status = 422,
        public readonly string $errorCode = 'profile_invalid',
        public readonly ?int $currentVersion = null,
        string $message = 'That is not a counter permission profile.',
    ) {
        parent::__construct($message);
    }

    public function response(): JsonResponse
    {
        if ($this->status === 409) {
            return response()->json([
                'success' => false,
                'code' => $this->errorCode,
                'message' => $this->getMessage(),
                'current_version' => $this->currentVersion,
            ], 409);
        }

        return response()->json(['message' => $this->getMessage(), 'errors' => $this->errors], $this->status);
    }
}
