# Pizza Pia Print Bridge — Windows raw print helper.
# ESC/POS byte'larını Windows winspool.drv API'si üzerinden RAW datatype ile
# yazıcıya gönderir. Bu yöntem driver tarafından bytes'ı re-format etmez —
# yazıcı ESC/POS komutlarını doğrudan yorumlar.
#
# Çağrı:
#   powershell -ExecutionPolicy Bypass -File raw-print.ps1 `
#     -FilePath C:\temp\receipt.bin -PrinterName "Gainscha GA-E200I"

param(
    [Parameter(Mandatory=$true)] [string]$FilePath,
    [Parameter(Mandatory=$true)] [string]$PrinterName
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $FilePath)) {
    Write-Error "FILE_NOT_FOUND: $FilePath"
    exit 2
}

# WinAPI P/Invoke wrapper'ı — winspool.drv'nin OpenPrinter / StartDocPrinter /
# WritePrinter / EndDocPrinter / ClosePrinter zincirini sarıyor.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOC_INFO_1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter,
        out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOC_INFO_1 di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes,
        Int32 dwCount, out Int32 dwWritten);

    public static int SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        DOC_INFO_1 di = new DOC_INFO_1();
        di.pDocName = "Pizza Pia Adisyon";
        di.pDataType = "RAW";

        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            return 10; // OPEN_FAILED
        }
        try {
            if (!StartDocPrinter(hPrinter, 1, di)) return 11;
            try {
                if (!StartPagePrinter(hPrinter)) return 12;
                try {
                    Int32 dwWritten = 0;
                    IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                    try {
                        Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
                        if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out dwWritten)) {
                            return 13;
                        }
                    } finally {
                        Marshal.FreeCoTaskMem(pUnmanaged);
                    }
                } finally {
                    EndPagePrinter(hPrinter);
                }
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
        return 0;
    }
}
"@

try {
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
} catch {
    Write-Error "READ_FAILED: $($_.Exception.Message)"
    exit 3
}

$result = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)

switch ($result) {
    0  { Write-Output "OK"; exit 0 }
    10 { Write-Error "OPEN_PRINTER_FAILED: '$PrinterName' bulunamadı veya erişilemedi"; exit 10 }
    11 { Write-Error "START_DOC_FAILED"; exit 11 }
    12 { Write-Error "START_PAGE_FAILED"; exit 12 }
    13 { Write-Error "WRITE_FAILED"; exit 13 }
    default { Write-Error "UNKNOWN_ERROR ($result)"; exit 99 }
}
