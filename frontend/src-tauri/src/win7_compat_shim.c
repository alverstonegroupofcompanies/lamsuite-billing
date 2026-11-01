#if defined(_WIN32) || defined(_WIN64)

#include <windows.h>

#ifndef APPMODEL_ERROR_NO_PACKAGE
#define APPMODEL_ERROR_NO_PACKAGE 15700L
#endif

/*
 * Windows 7 SP1 & 8.1 API Compatibility Shim
 *
 * Provides local resolutions for Windows 8+ AppModel and Kernel APIs that are
 * statically referenced by modern WebView2LoaderStatic.lib or toolchain components.
 * By defining both the direct symbol and the __imp_ function pointer locally,
 * the MSVC linker satisfies the references from this object and avoids emitting
 * static import directory entries for KERNEL32.dll that would otherwise cause
 * "The procedure entry point ... could not be located in KERNEL32.dll" errors on Windows 7.
 */

// --- 1. PackageIdFromFullName ---
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

// --- 2. GetPackageFamilyName ---
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

// --- 3. GetPackageFullName ---
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

// --- 4. GetCurrentPackageFamilyName ---
LONG WINAPI Shim_GetCurrentPackageFamilyName(UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    (void)packageFamilyNameLength;
    (void)packageFamilyName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetCurrentPackageFamilyName)(UINT32*, PWSTR) = Shim_GetCurrentPackageFamilyName;
LONG WINAPI GetCurrentPackageFamilyName(UINT32 *packageFamilyNameLength, PWSTR packageFamilyName) {
    return Shim_GetCurrentPackageFamilyName(packageFamilyNameLength, packageFamilyName);
}

// --- 5. GetCurrentPackageFullName ---
LONG WINAPI Shim_GetCurrentPackageFullName(UINT32 *packageFullNameLength, PWSTR packageFullName) {
    (void)packageFullNameLength;
    (void)packageFullName;
    return APPMODEL_ERROR_NO_PACKAGE;
}
LONG (WINAPI *__imp_GetCurrentPackageFullName)(UINT32*, PWSTR) = Shim_GetCurrentPackageFullName;
LONG WINAPI GetCurrentPackageFullName(UINT32 *packageFullNameLength, PWSTR packageFullName) {
    return Shim_GetCurrentPackageFullName(packageFullNameLength, packageFullName);
}

// --- 6. GetPackagePathByFullName ---
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

// --- 7. GetSystemTimePreciseAsFileTime ---
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

// --- 8. SetThreadDescription ---
HRESULT WINAPI Shim_SetThreadDescription(HANDLE hThread, PCWSTR lpThreadDescription) {
    (void)hThread;
    (void)lpThreadDescription;
    return S_OK;
}
HRESULT (WINAPI *__imp_SetThreadDescription)(HANDLE, PCWSTR) = Shim_SetThreadDescription;
HRESULT WINAPI SetThreadDescription(HANDLE hThread, PCWSTR lpThreadDescription) {
    return Shim_SetThreadDescription(hThread, lpThreadDescription);
}

#endif // defined(_WIN32) || defined(_WIN64)
