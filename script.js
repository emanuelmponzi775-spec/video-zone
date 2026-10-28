const videoFile = document.getElementById("videoFile");
const player = document.getElementById("player");

if (videoFile && player) {
  videoFile.addEventListener("change", function () {
    const file = this.files[0];

    if (file) {
      player.src = URL.createObjectURL(file);
      player.hidden = false;
      player.load();
    }
  });
}

console.log("VIDEO ZONE is ready!");