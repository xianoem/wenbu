#include <windows.h>

#include <cstdio>
#include <thread>

namespace
{

constexpr DWORD doubleTapMillis = 500;
constexpr DWORD clipboardWaitMillis = 400;
constexpr UINT pollMillis = 15;
constexpr UINT doubleTapMessage = WM_APP + 1;

DWORD mainThread = 0;
bool tapped = false;
bool cHeld = false;
DWORD firstTapAt = 0;

bool isDown(int key)
{
    return (GetAsyncKeyState(key) & 0x8000) != 0;
}

bool isControl(DWORD key)
{
    return key == VK_CONTROL || key == VK_LCONTROL || key == VK_RCONTROL;
}

void onKey(DWORD key, bool pressed, DWORD time)
{
    if (isControl(key)) {
        if (!pressed) {
            tapped = false;
        }

        return;
    }

    if (key != 'C') {
        if (pressed) {
            tapped = false;
        }

        return;
    }

    if (!pressed) {
        cHeld = false;

        return;
    }

    if (cHeld) {
        return;
    }

    cHeld = true;

    const bool otherModifier =
        isDown(VK_MENU) || isDown(VK_SHIFT) || isDown(VK_LWIN) || isDown(VK_RWIN);

    if (!isDown(VK_CONTROL) || otherModifier) {
        tapped = false;

        return;
    }

    if (tapped && time - firstTapAt <= doubleTapMillis) {
        tapped = false;
        PostThreadMessageW(mainThread, doubleTapMessage, 0, 0);

        return;
    }

    tapped = true;
    firstTapAt = time;
}

LRESULT CALLBACK keyboardHook(int code, WPARAM message, LPARAM data)
{
    if (code == HC_ACTION) {
        const auto *key = reinterpret_cast<const KBDLLHOOKSTRUCT *>(data);

        onKey(key->vkCode, message == WM_KEYDOWN || message == WM_SYSKEYDOWN, key->time);
    }

    return CallNextHookEx(nullptr, code, message, data);
}

void reportCopy()
{
    std::fputs("copy\n", stdout);
    std::fflush(stdout);
}

} // namespace

int main()
{
    mainThread = GetCurrentThreadId();

    MSG message;
    PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);

    HHOOK hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardHook, GetModuleHandleW(nullptr), 0);

    if (hook == nullptr) {
        std::fprintf(stderr, "The keyboard hook could not be installed (error %lu).\n", GetLastError());

        return 1;
    }

    std::thread([] {
        while (std::fgetc(stdin) != EOF) {
        }

        PostThreadMessageW(mainThread, WM_QUIT, 0, 0);
    }).detach();

    UINT_PTR timer = 0;
    DWORD sequence = 0;
    DWORD waitingSince = 0;
    bool changed = false;

    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (message.message == doubleTapMessage) {
            sequence = GetClipboardSequenceNumber();
            waitingSince = GetTickCount();
            changed = false;

            if (timer == 0) {
                timer = SetTimer(nullptr, 0, pollMillis, nullptr);
            }

            continue;
        }

        if (message.message == WM_TIMER && message.hwnd == nullptr && message.wParam == timer) {
            if (changed || GetTickCount() - waitingSince > clipboardWaitMillis) {
                KillTimer(nullptr, timer);
                timer = 0;

                if (changed) {
                    reportCopy();
                }

                continue;
            }

            changed = GetClipboardSequenceNumber() != sequence;

            continue;
        }

        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    UnhookWindowsHookEx(hook);

    return 0;
}
