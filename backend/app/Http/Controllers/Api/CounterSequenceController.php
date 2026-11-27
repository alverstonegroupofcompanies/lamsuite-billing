<?php

namespace App\Http\Controllers\Api;

use App\Models\Counter;
use App\Services\CounterSequenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CNT-014 — the series a workstation numbers its own documents from.
 *
 * The device token names the counter; no parameter in the request can choose a
 * different one. A lease reserves a block of numbers for a counter working away
 * from the server, and the manifest is the same object the claim and the boot
 * context answer with.
 */
class CounterSequenceController
{
    public function __construct(private readonly CounterSequenceService $sequences)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $manifest = $this->sequences->manifest($counter);

        return response()->json(['success' => true] + $manifest);
    }

    public function lease(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $validated = $request->validate([
            'doc_type' => ['required', 'string', 'in:' . implode(',', CounterSequenceService::docTypes())
                . ',' . implode(',', array_keys(CounterSequenceService::DOC_TYPE_ALIASES))],
            'block_size' => 'nullable|integer|min:5|max:1000',
            'financial_year' => 'nullable|string',
            'used_through' => 'nullable|integer|min:0',
        ], [
            'doc_type.in' => 'The document series must be one of: ' . implode(', ', CounterSequenceService::docTypes()) . '.',
        ]);

        $block = $this->sequences->lease(
            $counter,
            $validated['doc_type'],
            (int) ($validated['block_size'] ?? CounterSequenceService::DEFAULT_BLOCK_SIZE),
            $validated['financial_year'] ?? null,
            isset($validated['used_through']) ? (int) $validated['used_through'] : null,
        );

        return response()->json([
            'success' => true,
            'counter_id' => $block['counter_id'],
            'counter_code' => $block['counter_code'],
            'doc_type' => $block['doc_type'],
            'prefix' => $block['prefix'],
            'financial_year' => $block['financial_year'],
            'range_start' => $block['range_start'],
            'range_end' => $block['range_end'],
            'block_size' => $block['block_size'],
            'next_number' => $block['next_number'],
            // TALLY-01: the till reads its lease off this object, so the rendering rule the numbers
            // in it print under travels here too, not only inside `leased_block`.
            'suffix' => $block['suffix'],
            'serial_width' => $block['serial_width'],
            'pad_zeros' => $block['pad_zeros'],
            'leased_block' => $block,
            'sequences' => $this->sequences->manifest($counter, $block['financial_year']),
            'message' => "Numbers {$block['range_start']}-{$block['range_end']} reserved for {$block['prefix']}.",
        ]);
    }

    private function counter(Request $request): ?Counter
    {
        $id = $request->attributes->get('device_counter_id');

        return $id ? Counter::find($id) : null;
    }

    private function unclaimed(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => 'counter_unclaimed',
            'message' => 'This workstation is not on a counter yet. Ask the store owner for a counter activation code.',
        ], 409);
    }
}
