export const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import x from 'x'
-const a = 1
+const a = 2
+const b = 3
 export { a }

@@ -20,3 +21,3 @@ function tail() {
   one
-  two
+  deux
   three
`

export const ADDED = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`

export const DELETED = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
`

export const RENAMED = `diff --git a/a.ts b/b.ts
similarity index 90%
rename from a.ts
rename to b.ts
index 5555555..6666666 100644
--- a/a.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`

export const BINARY = `diff --git a/img.png b/img.png
index 7777777..8888888 100644
Binary files a/img.png and b/img.png differ
`

export const NO_NEWLINE = `diff --git a/n.txt b/n.txt
index 9999999..aaaaaaa 100644
--- a/n.txt
+++ b/n.txt
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
\\ No newline at end of file
`

export const ALL = [MODIFIED, ADDED, DELETED, RENAMED, BINARY, NO_NEWLINE].join('')
