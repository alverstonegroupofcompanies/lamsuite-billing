<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Invoice;

class InvoiceController
{
    public function index(Request $request): JsonResponse
    {
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');
        $builder = Invoice::with('items')->orderBy('id', 'desc');

        if ($startDate && $endDate) {
            $builder->whereBetween('invoice_date', [$startDate, $endDate]);
        }

        return response()->json($builder->paginate(20));
    }

    public function store(Request $request): JsonResponse
    {
        $invoice = Invoice::create($request->all());
        return response()->json($invoice, 201);
    }

    public function show(string $id): JsonResponse
    {
        $invoice = Invoice::with('items')->findOrFail($id);
        return response()->json($invoice);
    }

    public function cancel(string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $invoice->update(['status' => 'cancelled']);
        return response()->json(['success' => true, 'status' => 'cancelled']);
    }
}
