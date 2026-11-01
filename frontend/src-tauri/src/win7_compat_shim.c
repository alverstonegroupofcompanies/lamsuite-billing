#if defined(_WIN32) || defined(_WIN64)

#define _WIN32_WINNT 0x0601 // Target Windows 7 SP1

#include <windows.h>
#include <stdint.h>

#ifndef APPMODEL_ERROR_NO_PACKAGE
#define APPMODEL_ERROR_NO_PACKAGE 15700L
#endif

/*
 * Windows 7 SP1 & 8.1 API Compatibility Shim
 *
 * Provides local resolutions for Windows 8+ AppModel, Synchronization, Memory,
 * and Kernel APIs that are statically referenced by modern WebView2LoaderStatic.lib,
 * Rust standard library (1.78+), or toolchain components.
 *
 * By defining both direct symbols and their __imp_ function pointers locally in an
 * object file linked with /NODEFAULTLIB:synchronization.lib and /FORCE:MULTIPLE,
 * the MSVC linker satisfies references from this object and eliminates static
 * import table entries for KERNEL32.dll and api-ms-win-core-synch-l1-2-0.dll.
 */

// ============================================================================
// 1. AppModel APIs (Referenced by WebView2LoaderStatic.lib)
// ============================================================================

LONG WINAPI Shim_PackageIdFromFullName(PCWSTR packageFullName, const UINT32 flags, UINT32 *bufferLength, BYTE *buffer) {
    (void)packageFullName;
    (void)flags;
    (void)bufferLength;
    (void)buffer;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_PackageIdFromFullName)(PCWSTR, const UINT32, UINT32*, BYTE*) = Shim_PackageIdFromFullName;
LONG WINAPI PackageIdFromFullName(PCWSTR packageFullName, const UINT32 flags, UINT32 *bufferLength, BYTE *buffer) {
    return Shim_PackageIdFromFullName(packageFullName, flags, bufferLength, buffer);
}

LONG WINAPI Shim_GetPackageFamilyName(HANDLE hProcess, UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    (void)hProcess;
    (void)packageFamilyNameLength;
    (void)packageFamilyName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetPackageFamilyName)(HANDLE, UINT32*, PWSTR) = Shim_GetPackageFamilyName;
LONG WINAPI GetPackageFamilyName(HANDLE hProcess, UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    return Shim_GetPackageFamilyName(hProcess, packageFamilyNameLength, packageFamilyName);
}

LONG WINAPI Shim_GetPackageFullName(HANDLE hProcess, UINT32 *packageFullNameLength, PWSTR packageFullName) {
    (void)hProcess;
    (void)packageFullNameLength;
    (void)packageFullName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetPackageFullName)(HANDLE, UINT32*, PWSTR) = Shim_GetPackageFullName;
LONG WINAPI GetPackageFullName(HANDLE hProcess, UINT32 *packageFullNameLength, PWSTR packageFullName) {
    return Shim_GetPackageFullName(hProcess, packageFullNameLength, packageFullName);
}

LONG WINAPI Shim_GetCurrentPackageFamilyName(UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    (void)packageFamilyNameLength;
    (void)packageFamilyName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetCurrentPackageFamilyName)(UINT32*, PWSTR) = Shim_GetCurrentPackageFamilyName;
LONG WINAPI GetCurrentPackageFamilyName(UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    return Shim_GetCurrentPackageFamilyName(packageFamilyNameLength, packageFamilyName);
}

LONG WINAPI Shim_GetCurrentPackageFullName(UINT32 *packageFullNameLength, PWSTR packageFullName) {
    (void)packageFullNameLength;
    (void)packageFullName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetCurrentPackageFullName)(UINT32*, PWSTR) = Shim_GetCurrentPackageFullName;
LONG WINAPI GetCurrentPackageFullName(UINT32 *packageFullNameLength, PWSTR packageFullName) {
    return Shim_GetCurrentPackageFullName(packageFullNameLength, packageFullName);
}

LONG WINAPI Shim_GetPackagePathByFullName(PCWSTR packageFullName, UINT32 *pathLength, PWSTR path) {
    (void)packageFullName;
    (void)pathLength;
    (void)path;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetPackagePathByFullName)(PCWSTR, UINT32*, PWSTR) = Shim_GetPackagePathByFullName;
LONG WINAPI GetPackagePathByFullName(PCWSTR packageFullName, UINT32 *pathLength, PWSTR path) {
    return Shim_GetPackagePathByFullName(packageFullName, pathLength, path);
}

// ============================================================================
// 2. High-Precision Timing API (Referenced by Rust std Instant::now)
// ============================================================================

typedef VOID (WINAPI *PFN_GetSystemTimePreciseAsFileTime)(LPFILETIME);
VOID WINAPI Shim_GetSystemTimePreciseAsFileTime(LPFILETIME lpSystemTimeAsFileTime) {
    static PFN_GetSystemTimePreciseAsFileTime pfnReal = NULL;
    static BOOL bInitialized = FALSE;

    if (!bInitialized) {
        HMODULE hKernel32 = GetModuleHandleW(L"kernel32.dll");
        if (hKernel32) {
            pfnReal = (PFN_GetSystemTimePreciseAsFileTime)GetProcAddress(hKernel32, "GetSystemTimePreciseAsFileTime");
        }
        bInitialized = TRUE;
    }

    if (pfnReal) {
        pfnReal(lpSystemTimeAsFileTime);
    } else {
        GetSystemTimeAsFileTime(lpSystemTimeAsFileTime);
    }
}
VOID (WINAPI *__imp_GetSystemTimePreciseAsFileTime)(LPFILETIME) = Shim_GetSystemTimePreciseAsFileTime;
VOID WINAPI GetSystemTimePreciseAsFileTime(LPFILETIME lpSystemTimeAsFileTime) {
    Shim_GetSystemTimePreciseAsFileTime(lpSystemTimeAsFileTime);
}

// ============================================================================
// 3. Thread Description API
// ============================================================================

HRESULT WINAPI Shim_SetThreadDescription(HANDLE hThread, PCWSTR lpThreadDescription) {
    (void)hThread;
    (void)lpThreadDescription;
    return S_OK;
}
HRESULT (WINAPI *__imp_SetThreadDescription)(HANDLE, PCWSTR) = Shim_SetThreadDescription;
HRESULT WINAPI SetThreadDescription(HANDLE hThread, PCWSTR lpThreadDescription) {
    return Shim_SetThreadDescription(hThread, lpThreadDescription);
}

// ============================================================================
// 4. Synchronization APIs (WaitOnAddress / WakeByAddressSingle / WakeByAddressAll)
//    Referenced by modern Rust std synchronization primitives (parking_lot / thread park).
//    On Windows 8+, dispatches to OS synchronization. On Windows 7 SP1, falls back
//    to a hashed table of native SRWLock and CONDITION_VARIABLE primitives.
// ============================================================================

typedef BOOL (WINAPI *PFN_WaitOnAddress)(volatile VOID*, PVOID, SIZE_T, DWORD);
typedef VOID (WINAPI *PFN_WakeByAddressSingle)(PVOID);
typedef VOID (WINAPI *PFN_WakeByAddressAll)(PVOID);

static PFN_WaitOnAddress g_pfnRealWaitOnAddress = NULL;
static PFN_WakeByAddressSingle g_pfnRealWakeByAddressSingle = NULL;
static PFN_WakeByAddressAll g_pfnRealWakeByAddressAll = NULL;
static BOOL g_synchInitialized = FALSE;

#define FUTEX_HASH_BITS 7
#define FUTEX_BUCKETS (1 << FUTEX_HASH_BITS) /* 128 buckets */

static SRWLOCK g_futex_locks[FUTEX_BUCKETS];
static CONDITION_VARIABLE g_futex_cvs[FUTEX_BUCKETS];

static inline unsigned int FutexHash(const void *addr) {
    uintptr_t val = (uintptr_t)addr;
    val ^= (val >> 16);
    val ^= (val >> 8);
    return (unsigned int)(val & (FUTEX_BUCKETS - 1));
}

static void InitSynchApi(void) {
    if (g_synchInitialized) return;
    HMODULE hKernel32 = GetModuleHandleW(L"kernel32.dll");
    if (hKernel32) {
        g_pfnRealWaitOnAddress = (PFN_WaitOnAddress)GetProcAddress(hKernel32, "WaitOnAddress");
        g_pfnRealWakeByAddressSingle = (PFN_WakeByAddressSingle)GetProcAddress(hKernel32, "WakeByAddressSingle");
        g_pfnRealWakeByAddressAll = (PFN_WakeByAddressAll)GetProcAddress(hKernel32, "WakeByAddressAll");
    }
    if (!g_pfnRealWaitOnAddress) {
        HMODULE hSynch = LoadLibraryA("api-ms-win-core-synch-l1-2-0.dll");
        if (hSynch) {
            g_pfnRealWaitOnAddress = (PFN_WaitOnAddress)GetProcAddress(hSynch, "WaitOnAddress");
            g_pfnRealWakeByAddressSingle = (PFN_WakeByAddressSingle)GetProcAddress(hSynch, "WakeByAddressSingle");
            g_pfnRealWakeByAddressAll = (PFN_WakeByAddressAll)GetProcAddress(hSynch, "WakeByAddressAll");
        }
    }
    g_synchInitialized = TRUE;
}

BOOL WINAPI Shim_WaitOnAddress(volatile VOID *Address, PVOID CompareAddress, SIZE_T AddressSize, DWORD dwMilliseconds) {
    InitSynchApi();
    if (g_pfnRealWaitOnAddress) {
        return g_pfnRealWaitOnAddress(Address, CompareAddress, AddressSize, dwMilliseconds);
    }

    if (AddressSize != 1 && AddressSize != 2 && AddressSize != 4 && AddressSize != 8) {
        SetLastError(ERROR_INVALID_PARAMETER);
        return FALSE;
    }

    unsigned int bucket = FutexHash(Address);
    AcquireSRWLockExclusive(&g_futex_locks[bucket]);

    BOOL match = FALSE;
    if (AddressSize == 1) {
        match = (*(const volatile char*)Address == *(const char*)CompareAddress);
    } else if (AddressSize == 2) {
        match = (*(const volatile short*)Address == *(const short*)CompareAddress);
    } else if (AddressSize == 4) {
        match = (*(const volatile long*)Address == *(const long*)CompareAddress);
    } else if (AddressSize == 8) {
        match = (*(const volatile long long*)Address == *(const long long*)CompareAddress);
    }

    if (!match) {
        ReleaseSRWLockExclusive(&g_futex_locks[bucket]);
        return TRUE;
    }

    BOOL ok = SleepConditionVariableSRW(&g_futex_cvs[bucket], &g_futex_locks[bucket], dwMilliseconds, 0);
    ReleaseSRWLockExclusive(&g_futex_locks[bucket]);

    if (!ok) {
        return FALSE;
    }
    return TRUE;
}
BOOL (WINAPI *__imp_WaitOnAddress)(volatile VOID*, PVOID, SIZE_T, DWORD) = Shim_WaitOnAddress;
BOOL WINAPI WaitOnAddress(volatile VOID *Address, PVOID CompareAddress, SIZE_T AddressSize, DWORD dwMilliseconds) {
    return Shim_WaitOnAddress(Address, CompareAddress, AddressSize, dwMilliseconds);
}

VOID WINAPI Shim_WakeByAddressSingle(PVOID Address) {
    InitSynchApi();
    if (g_pfnRealWakeByAddressSingle) {
        g_pfnRealWakeByAddressSingle(Address);
        return;
    }

    unsigned int bucket = FutexHash(Address);
    WakeConditionVariable(&g_futex_cvs[bucket]);
}
VOID (WINAPI *__imp_WakeByAddressSingle)(PVOID) = Shim_WakeByAddressSingle;
VOID WINAPI WakeByAddressSingle(PVOID Address) {
    Shim_WakeByAddressSingle(Address);
}

VOID WINAPI Shim_WakeByAddressAll(PVOID Address) {
    InitSynchApi();
    if (g_pfnRealWakeByAddressAll) {
        g_pfnRealWakeByAddressAll(Address);
        return;
    }

    unsigned int bucket = FutexHash(Address);
    WakeAllConditionVariable(&g_futex_cvs[bucket]);
}
VOID (WINAPI *__imp_WakeByAddressAll)(PVOID) = Shim_WakeByAddressAll;
VOID WINAPI WakeByAddressAll(PVOID Address) {
    Shim_WakeByAddressAll(Address);
}

// ============================================================================
// 5. File & Memory APIs (CreateFile2, VirtualAlloc2, MapViewOfFile3)
// ============================================================================

typedef struct _SHIM_CREATEFILE2_EXTENDED_PARAMETERS {
    DWORD dwSize;
    DWORD dwFileAttributes;
    DWORD dwFileFlags;
    DWORD dwSecurityQosFlags;
    LPSECURITY_ATTRIBUTES lpSecurityAttributes;
    HANDLE hTemplateFile;
} SHIM_CREATEFILE2_EXTENDED_PARAMETERS;

HANDLE WINAPI Shim_CreateFile2(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, DWORD dwCreationDisposition, void *pCreateExParams) {
    DWORD dwFlagsAndAttributes = FILE_ATTRIBUTE_NORMAL;
    if (pCreateExParams) {
        SHIM_CREATEFILE2_EXTENDED_PARAMETERS *p = (SHIM_CREATEFILE2_EXTENDED_PARAMETERS*)pCreateExParams;
        if (p->dwSize >= sizeof(DWORD) * 3) {
            dwFlagsAndAttributes = p->dwFileAttributes | p->dwFileFlags;
        }
    }
    return CreateFileW(lpFileName, dwDesiredAccess, dwShareMode, NULL, dwCreationDisposition, dwFlagsAndAttributes, NULL);
}
HANDLE (WINAPI *__imp_CreateFile2)(LPCWSTR, DWORD, DWORD, DWORD, void*) = Shim_CreateFile2;
HANDLE WINAPI CreateFile2(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, DWORD dwCreationDisposition, void *pCreateExParams) {
    return Shim_CreateFile2(lpFileName, dwDesiredAccess, dwShareMode, dwCreationDisposition, pCreateExParams);
}

PVOID WINAPI Shim_VirtualAlloc2(HANDLE Process, PVOID BaseAddress, SIZE_T Size, ULONG AllocationType, ULONG PageProtection, void *ExtendedParameters, ULONG ParameterCount) {
    (void)ExtendedParameters;
    (void)ParameterCount;
    HANDLE hProc = Process ? Process : GetCurrentProcess();
    return VirtualAllocEx(hProc, BaseAddress, Size, AllocationType, PageProtection);
}
PVOID (WINAPI *__imp_VirtualAlloc2)(HANDLE, PVOID, SIZE_T, ULONG, ULONG, void*, ULONG) = Shim_VirtualAlloc2;
PVOID WINAPI VirtualAlloc2(HANDLE Process, PVOID BaseAddress, SIZE_T Size, ULONG AllocationType, ULONG PageProtection, void *ExtendedParameters, ULONG ParameterCount) {
    return Shim_VirtualAlloc2(Process, BaseAddress, Size, AllocationType, PageProtection, ExtendedParameters, ParameterCount);
}

PVOID WINAPI Shim_MapViewOfFile3(HANDLE FileMapping, HANDLE Process, PVOID BaseAddress, ULONG64 Offset, SIZE_T ViewSize, ULONG AllocationType, ULONG PageProtection, void *ExtendedParameters, ULONG ParameterCount) {
    (void)Process;
    (void)BaseAddress;
    (void)AllocationType;
    (void)ExtendedParameters;
    (void)ParameterCount;
    DWORD offsetHigh = (DWORD)(Offset >> 32);
    DWORD offsetLow = (DWORD)(Offset & 0xFFFFFFFF);
    return MapViewOfFile(FileMapping, FILE_MAP_ALL_ACCESS, offsetHigh, offsetLow, ViewSize);
}
PVOID (WINAPI *__imp_MapViewOfFile3)(HANDLE, HANDLE, PVOID, ULONG64, SIZE_T, ULONG, ULONG, void*, ULONG) = Shim_MapViewOfFile3;
PVOID WINAPI MapViewOfFile3(HANDLE FileMapping, HANDLE Process, PVOID BaseAddress, ULONG64 Offset, SIZE_T ViewSize, ULONG AllocationType, ULONG PageProtection, void *ExtendedParameters, ULONG ParameterCount) {
    return Shim_MapViewOfFile3(FileMapping, Process, BaseAddress, Offset, ViewSize, AllocationType, PageProtection, ExtendedParameters, ParameterCount);
}

// ============================================================================
// 6. DPI APIs (GetDpiForWindow, SetProcessDpiAwarenessContext)
// ============================================================================

UINT WINAPI Shim_GetDpiForWindow(HWND hwnd) {
    (void)hwnd;
    HDC hdc = GetDC(NULL);
    UINT dpi = 96;
    if (hdc) {
        dpi = (UINT)GetDeviceCaps(hdc, LOGPIXELSX);
        ReleaseDC(NULL, hdc);
    }
    return dpi ? dpi : 96;
}
UINT (WINAPI *__imp_GetDpiForWindow)(HWND) = Shim_GetDpiForWindow;
UINT WINAPI GetDpiForWindow(HWND hwnd) {
    return Shim_GetDpiForWindow(hwnd);
}

BOOL WINAPI Shim_SetProcessDpiAwarenessContext(HANDLE value) {
    (void)value;
    typedef BOOL (WINAPI *PFN_SetProcessDPIAware)(VOID);
    HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
    if (hUser32) {
        PFN_SetProcessDPIAware pfn = (PFN_SetProcessDPIAware)GetProcAddress(hUser32, "SetProcessDPIAware");
        if (pfn) return pfn();
    }
    return TRUE;
}
BOOL (WINAPI *__imp_SetProcessDpiAwarenessContext)(HANDLE) = Shim_SetProcessDpiAwarenessContext;
BOOL WINAPI SetProcessDpiAwarenessContext(HANDLE value) {
    return Shim_SetProcessDpiAwarenessContext(value);
}

// ============================================================================
// 7. Cryptographic RNG API (ProcessPrng)
//    Referenced by modern getrandom (0.3+) / uuid on Windows.
//    ProcessPrng is missing from bcryptprimitives.dll on Windows 7 SP1.
//    On Windows 8+, dispatches to real ProcessPrng in bcryptprimitives.dll.
//    On Windows 7 SP1, falls back to RtlGenRandom (SystemFunction036 in advapi32.dll).
// ============================================================================

typedef BOOL (WINAPI *PFN_ProcessPrng)(PBYTE, SIZE_T);
typedef BOOLEAN (WINAPI *PFN_RtlGenRandom)(PVOID, ULONG);

static PFN_ProcessPrng g_pfnRealProcessPrng = NULL;
static PFN_RtlGenRandom g_pfnRtlGenRandom = NULL;
static BOOL g_prngInitialized = FALSE;

static void InitPrngApi(void) {
    if (g_prngInitialized) return;

    HMODULE hBcryptPrimitives = LoadLibraryA("bcryptprimitives.dll");
    if (hBcryptPrimitives) {
        g_pfnRealProcessPrng = (PFN_ProcessPrng)GetProcAddress(hBcryptPrimitives, "ProcessPrng");
    }

    if (!g_pfnRealProcessPrng) {
        HMODULE hAdvapi32 = GetModuleHandleW(L"advapi32.dll");
        if (!hAdvapi32) {
            hAdvapi32 = LoadLibraryW(L"advapi32.dll");
        }
        if (hAdvapi32) {
            g_pfnRtlGenRandom = (PFN_RtlGenRandom)GetProcAddress(hAdvapi32, "SystemFunction036");
        }
    }
    g_prngInitialized = TRUE;
}

BOOL WINAPI Shim_ProcessPrng(PBYTE pbData, SIZE_T cbData) {
    InitPrngApi();
    if (g_pfnRealProcessPrng) {
        return g_pfnRealProcessPrng(pbData, cbData);
    }

    if (g_pfnRtlGenRandom && pbData && cbData > 0) {
        SIZE_T remaining = cbData;
        PBYTE ptr = pbData;
        while (remaining > 0) {
            ULONG chunk = (remaining > 0xFFFFFFFF) ? 0xFFFFFFFF : (ULONG)remaining;
            if (!g_pfnRtlGenRandom(ptr, chunk)) {
                return FALSE;
            }
            ptr += chunk;
            remaining -= chunk;
        }
        return TRUE;
    }

    return FALSE;
}
BOOL (WINAPI *__imp_ProcessPrng)(PBYTE, SIZE_T) = Shim_ProcessPrng;
BOOL WINAPI ProcessPrng(PBYTE pbData, SIZE_T cbData) {
    return Shim_ProcessPrng(pbData, cbData);
}

// ============================================================================
// 8. Windows 7 FastFail (INT 29h) Handler & Initialization
//    On Windows 8+, __fastfail is a native CPU/kernel contract (INT 29h).
//    On Windows 7 SP1, INT 29h is not handled and raises EXCEPTION_ACCESS_VIOLATION
//    (0xC0000005). We catch it in a Vectored Exception Handler to display a clear
//    diagnostic message box instead of an opaque crash dialog.
// ============================================================================

static LONG WINAPI VectoredCrashFilter(PEXCEPTION_POINTERS pExceptionInfo) {
    if (pExceptionInfo && pExceptionInfo->ExceptionRecord) {
        DWORD code = pExceptionInfo->ExceptionRecord->ExceptionCode;
        unsigned char *ip = (unsigned char*)pExceptionInfo->ExceptionRecord->ExceptionAddress;
        if (code == 0xC0000005 || code == 0xC000001D) {
            if (ip && ip[0] == 0xCD && ip[1] == 0x29) {
                DWORD fastFailCode = 7;
#if defined(_WIN64)
                if (pExceptionInfo->ContextRecord) {
                    fastFailCode = (DWORD)pExceptionInfo->ContextRecord->Rcx;
                }
#endif
                char buf[512];
                wsprintfA(buf, "LamSuite Billing encountered a fatal abort (FastFail %u at %p).\n\nPlease verify that Microsoft Edge WebView2 runtime is installed.", fastFailCode, ip);
                MessageBoxA(NULL, buf, "LamSuite Billing - Fatal Exit", MB_ICONSTOP | MB_OK);
                ExitProcess(fastFailCode ? fastFailCode : 1);
            }
        }
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

void InitWin7CompatShim(void) {
    static BOOL initialized = FALSE;
    if (initialized) return;
    initialized = TRUE;
    AddVectoredExceptionHandler(1, VectoredCrashFilter);
    InitSynchApi();
    InitPrngApi();
}

#endif // defined(_WIN32) || defined(_WIN64)
