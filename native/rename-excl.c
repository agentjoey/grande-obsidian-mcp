#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

static const char *token_for_errno(int value) {
  switch (value) {
    case EEXIST: return "EEXIST";
    case ENOENT: return "ENOENT";
    case EXDEV: return "EXDEV";
    case ELOOP: return "ELOOP";
#ifdef ENOTCAPABLE
    case ENOTCAPABLE: return "ENOTCAPABLE";
#endif
    case ENOTDIR: return "ENOTDIR";
    case EINVAL: return "EINVAL";
#ifdef ENOTSUP
    case ENOTSUP: return "ENOTSUP";
#endif
    case EPERM: return "EPERM";
    case EACCES: return "EACCES";
    default: return "UNKNOWN";
  }
}

int main(int argc, char **argv) {
  if (argc != 4) {
    return 64;
  }

  int project_fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (project_fd < 0) {
    printf("ERR %s\n", token_for_errno(errno));
    return 1;
  }

  unsigned int flags = RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH;
  int result = renameatx_np(project_fd, argv[2], project_fd, argv[3], flags);
  int saved_errno = errno;
  close(project_fd);

  if (result == 0) {
    printf("OK\n");
    return 0;
  }

  printf("ERR %s\n", token_for_errno(saved_errno));
  return 1;
}
