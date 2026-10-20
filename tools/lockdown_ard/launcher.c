/* launchd runs this binary as ProgramArguments[0], so macOS charges Full Disk
   Access to it. Running python3 directly put the TCC check on python3, and on
   2026-10-15 kickstart could neither remove nor write RemoteManagement.launchd
   from the daemon. The child inherits this binary's grant, so it stays alive
   as the parent instead of exec'ing. */
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char *child[] = {"/usr/bin/python3",
                     "/Library/Application Support/LockDown ARD Switch/switch.py",
                     argc > 1 ? argv[1] : NULL, NULL};
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); return 1; }
    if (pid == 0) { execv(child[0], child); perror("execv"); _exit(127); }
    int status = 0;
    if (waitpid(pid, &status, 0) < 0) { perror("waitpid"); return 1; }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
