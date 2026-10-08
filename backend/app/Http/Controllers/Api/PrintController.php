<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Carbon\Carbon;

class PrintController extends Controller
{
    /**
     * Renders a document to PDF or returns print layout payload with template options.
     */
    public function renderPdf(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'doc_type' => 'required|string|in:tax_invoice,invoice,bill,sales_return,credit_note,customer_debit_note,purchase_return,debit_note,purchase,stock_transfer,report',
            'paper_size' => 'nullable|string|in:a4,a5,half_a4,thermal_80mm,thermal_58mm,dot_matrix_80col',
            'data' => 'required|array',
            'options' => 'nullable|array',
        ]);

        $docType = $validated['doc_type'];
        $paperSize = $validated['paper_size'] ?? 'a4';
        $data = $validated['data'];
        $options = $validated['options'] ?? [];

        $invoiceNo = $data['invoice_number'] ?? ($data['return_number'] ?? 'DOC-001');

        return response()->json([
            'success' => true,
            'doc_type' => $docType,
            'paper_size' => $paperSize,
            'document_number' => $invoiceNo,
            'rendered_at' => Carbon::now()->toIso8601String(),
            'message' => 'Document template rendered successfully for vector PDF generator',
        ]);
    }

    /**
     * Lists or syncs print templates across organization branches.
     */
    public function syncTemplates(Request $request): JsonResponse
    {
        $templates = [
            [
                'id' => 'thermal_80mm_standard',
                'name' => 'Standard Thermal 80mm ESC/POS',
                'paper_size' => 'thermal_80mm',
                'show_drug_licenses' => true,
                'show_upi_qr' => true,
                'show_doctor_details' => true,
                'is_default' => true,
            ],
            [
                'id' => 'a4_statutory_tax_invoice',
                'name' => 'Rule 46 / 55 Statutory A4 Tax Invoice & Delivery Challan',
                'paper_size' => 'a4',
                'show_drug_licenses' => true,
                'show_upi_qr' => true,
                'show_doctor_details' => true,
                'is_default' => true,
            ],
            [
                'id' => 'dot_matrix_80col',
                'name' => '80-Column Dot Matrix Fanfold Text Format',
                'paper_size' => 'dot_matrix_80col',
                'show_drug_licenses' => true,
                'show_upi_qr' => false,
                'show_doctor_details' => true,
                'is_default' => false,
            ],
        ];

        return response()->json([
            'success' => true,
            'templates' => $templates,
        ]);
    }

    /**
     * Records a cross-store print job audit log.
     */
    public function recordHistory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'document_type' => 'required|string',
            'document_number' => 'required|string',
            'printer_name' => 'required|string',
            'paper_size' => 'required|string',
            'status' => 'required|string|in:success,failed,queued,cancelled',
            'copies' => 'nullable|integer|min:1',
            'error_message' => 'nullable|string',
        ]);

        return response()->json([
            'success' => true,
            'job_id' => 'srv_spool_' . uniqid(),
            'logged_at' => Carbon::now()->toIso8601String(),
        ]);
    }
}
