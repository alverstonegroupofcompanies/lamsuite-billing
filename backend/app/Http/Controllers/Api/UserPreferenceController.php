<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserPreferenceController extends Controller
{
    /**
     * Per-user UI preferences (default bill period, column layout, etc.).
     * Stored per user, never per store, so switching stores keeps the operator's setup.
     */
    public function show(Request $request): JsonResponse
    {
        $preference = UserPreference::firstOrCreate(
            ['user_id' => $request->user()->id],
            ['preferences' => []]
        );

        return response()->json([
            'preferences' => $preference->preferences ?? [],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array'],
            'replace' => ['sometimes', 'boolean'],
        ]);

        $preference = UserPreference::firstOrCreate(
            ['user_id' => $request->user()->id],
            ['preferences' => []]
        );

        $existing = $preference->preferences ?? [];
        $preference->preferences = $request->boolean('replace')
            ? $validated['preferences']
            : array_replace($existing, $validated['preferences']);
        $preference->save();

        return response()->json([
            'preferences' => $preference->preferences,
        ]);
    }
}
